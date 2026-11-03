/**
 * A user's own research: saved judgments, private notes on them, and folders.
 *
 * Every query below is filtered by `userId: req.user._id`. That filter is the
 * whole access-control story — there is no route that takes a user id from the
 * client, so nobody can ask for someone else's saved cases.
 */
import { Router } from 'express';
import { ObjectId, type Filter } from 'mongodb';
import { z } from 'zod';
import { folders, nodes, savedCases } from '../config.js';
import { requireAuth } from '../lib/auth.js';
import { deriveTier } from '../lib/search.js';
import { treatmentCounts } from '../lib/treatment.js';
import type { FolderDoc, SavedCaseDoc } from '../types.js';

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

const MAX_FOLDERS = 100;
const MAX_SAVED = 2000;

/** Folders are created lazily, so their indexes are ensured at startup. */
export async function ensureWorkspaceIndexes() {
  await savedCases.createIndex({ userId: 1, tid: 1 }, { unique: true, name: 'user_tid_unique' });
  await savedCases.createIndex({ userId: 1, folderIds: 1, updatedAt: -1 }, { name: 'user_folder' });
  await folders.createIndex(
    { userId: 1, name: 1 },
    // Case-insensitive, so "Sharma" and "sharma" cannot both exist.
    { unique: true, name: 'user_name_unique', collation: { locale: 'en', strength: 2 } },
  );
}

const publicSaved = (s: SavedCaseDoc) => ({
  tid: s.tid,
  title: s.title,
  year: s.year,
  court: s.court,
  courtTier: s.courtTier,
  note: s.note,
  folderIds: s.folderIds.map(String),
  savedAt: s.createdAt,
  updatedAt: s.updatedAt,
});

export const publicFolder = (f: FolderDoc, count = 0) => ({
  id: String(f._id),
  name: f.name,
  description: f.description ?? null,
  count,
  createdAt: f.createdAt,
  matter: f.matter ?? null,
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parse a tid route param; null if it is not a positive integer. */
function tidParam(raw: string) {
  const tid = Number(raw);
  return Number.isInteger(tid) && tid > 0 ? tid : null;
}

/** The given folder ids, but only if every one belongs to this user. */
async function ownFolderIds(userId: ObjectId, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.every((id) => ObjectId.isValid(id))) return null;
  const objectIds = unique.map((id) => new ObjectId(id));
  const n = await folders.countDocuments({ userId, _id: { $in: objectIds } });
  return n === objectIds.length ? objectIds : null;
}

/* ------------------------------------------------------------ saved cases */

const listSchema = z.object({
  /** 'all', 'unfiled', or a folder id */
  folder: z.string().default('all'),
  q: z.string().trim().max(200).optional(),
});

/** GET /api/me/saved?folder=all|unfiled|<folderId>&q=  newest first. */
workspaceRouter.get('/saved', async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Bad filter.' });
    const { folder, q } = parsed.data;
    const userId = req.user!._id;

    const filter: Filter<SavedCaseDoc> = { userId };
    if (folder === 'unfiled') filter.folderIds = { $size: 0 };
    else if (folder !== 'all') {
      if (!ObjectId.isValid(folder)) return res.status(404).json({ error: 'Folder not found.' });
      filter.folderIds = new ObjectId(folder);
    }
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: rx }, { note: rx }];
    }

    const items = await savedCases.find(filter).sort({ updatedAt: -1 }).limit(500).toArray();
    // The precedent check: how later judgments treated each saved one.
    const counts = await treatmentCounts(items.map((i) => i.tid));
    res.json({ items: items.map((i) => ({ ...publicSaved(i), treatment: counts.get(i.tid) })) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/me/saved/ids  every tid this user has saved — lets search results
 *  show a filled bookmark without one request per result. */
workspaceRouter.get('/saved/ids', async (req, res, next) => {
  try {
    const rows = await savedCases.find({ userId: req.user!._id }).project<{ tid: number }>({ tid: 1, _id: 0 }).toArray();
    res.json({ tids: rows.map((r) => r.tid) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/me/saved/:tid  this user's saved entry for one case, or null. */
workspaceRouter.get('/saved/:tid', async (req, res, next) => {
  try {
    const tid = tidParam(req.params.tid);
    if (tid === null) return res.status(404).json({ error: 'Case not found.' });
    const item = await savedCases.findOne({ userId: req.user!._id, tid });
    res.json({ item: item ? publicSaved(item) : null });
  } catch (err) {
    next(err);
  }
});

const saveSchema = z.object({
  note: z.string().max(5000, 'Notes can be at most 5,000 characters').optional(),
  folderIds: z.array(z.string()).max(50).optional(),
});

/**
 * PUT /api/me/saved/:tid  save a judgment, or update its note / folders.
 *
 * PUT because it is idempotent: saving twice is the same as saving once.
 * The title is looked up here rather than accepted from the client, so a saved
 * entry always names the judgment it points at.
 */
workspaceRouter.put('/saved/:tid', async (req, res, next) => {
  try {
    const tid = tidParam(req.params.tid);
    if (tid === null) return res.status(404).json({ error: 'Case not found.' });
    const parsed = saveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { note, folderIds } = parsed.data;
    const userId = req.user!._id;

    const node = await nodes.findOne({ _id: tid }, { projection: { title: 1, publishdate: 1, docsource: 1 } });
    if (!node) return res.status(404).json({ error: 'Case not found.' });

    const existing = await savedCases.findOne({ userId, tid }, { projection: { _id: 1 } });
    if (!existing && (await savedCases.countDocuments({ userId })) >= MAX_SAVED) {
      return res.status(400).json({ error: `You can save at most ${MAX_SAVED} judgments.` });
    }

    const $set: Partial<SavedCaseDoc> = {
      title: node.title,
      year: Number(String(node.publishdate ?? '').slice(0, 4)) || null,
      court: node.docsource ?? 'unknown',
      courtTier: deriveTier(node.docsource),
      updatedAt: new Date(),
    };
    if (note !== undefined) $set.note = note.trim();
    if (folderIds !== undefined) {
      const own = await ownFolderIds(userId, folderIds);
      if (!own) return res.status(400).json({ error: 'One of those folders does not exist.' });
      $set.folderIds = own;
    }
    // Defaults for a first save; a field may not appear in both $set and $setOnInsert.
    const $setOnInsert: Partial<SavedCaseDoc> = { userId, tid, createdAt: new Date() };
    if (note === undefined) $setOnInsert.note = '';
    if (folderIds === undefined) $setOnInsert.folderIds = [];

    const saved = await savedCases.findOneAndUpdate(
      { userId, tid },
      { $set, $setOnInsert },
      { upsert: true, returnDocument: 'after' },
    );
    res.json({ item: publicSaved(saved!) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/me/saved/:tid  unsave (the note goes with it). */
workspaceRouter.delete('/saved/:tid', async (req, res, next) => {
  try {
    const tid = tidParam(req.params.tid);
    if (tid === null) return res.status(404).json({ error: 'Case not found.' });
    await savedCases.deleteOne({ userId: req.user!._id, tid });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------- folders */

const folderSchema = z.object({
  name: z.string().trim().min(1, 'Give the folder a name').max(60, 'Folder names can be at most 60 characters'),
  description: z.string().trim().max(300).optional(),
});

const isDuplicate = (err: unknown) => (err as { code?: number })?.code === 11000;

/** GET /api/me/folders  with how many saved judgments are in each. */
workspaceRouter.get('/folders', async (req, res, next) => {
  try {
    const userId = req.user!._id;
    const [list, counts, total, unfiled] = await Promise.all([
      folders.find({ userId }).sort({ name: 1 }).collation({ locale: 'en', strength: 2 }).toArray(),
      savedCases
        .aggregate<{ _id: ObjectId; n: number }>([
          { $match: { userId } },
          { $unwind: '$folderIds' },
          { $group: { _id: '$folderIds', n: { $sum: 1 } } },
        ])
        .toArray(),
      savedCases.countDocuments({ userId }),
      savedCases.countDocuments({ userId, folderIds: { $size: 0 } }),
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({
      folders: list.map((f) => publicFolder(f, byId.get(String(f._id)) ?? 0)),
      total,
      unfiled,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/me/folders */
workspaceRouter.post('/folders', async (req, res, next) => {
  try {
    const parsed = folderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, field: 'name' });
    const userId = req.user!._id;
    if ((await folders.countDocuments({ userId })) >= MAX_FOLDERS) {
      return res.status(400).json({ error: `You can have at most ${MAX_FOLDERS} folders.` });
    }
    const now = new Date();
    const doc: FolderDoc = { userId, name: parsed.data.name, createdAt: now, updatedAt: now };
    if (parsed.data.description) doc.description = parsed.data.description;
    try {
      const { insertedId } = await folders.insertOne(doc);
      res.status(201).json({ folder: publicFolder({ ...doc, _id: insertedId }) });
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: 'You already have a folder with that name.', field: 'name' });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/me/folders/:id  rename or re-describe. */
workspaceRouter.patch('/folders/:id', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Folder not found.' });
    const parsed = folderSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, field: 'name' });
    const { name, description } = parsed.data;
    const $set: Partial<FolderDoc> = { updatedAt: new Date() };
    if (name !== undefined) $set.name = name;
    if (description !== undefined) $set.description = description;
    try {
      const updated = await folders.findOneAndUpdate(
        { _id: new ObjectId(req.params.id), userId: req.user!._id },
        { $set },
        { returnDocument: 'after' },
      );
      if (!updated) return res.status(404).json({ error: 'Folder not found.' });
      const count = await savedCases.countDocuments({ userId: req.user!._id, folderIds: updated._id });
      res.json({ folder: publicFolder(updated, count) });
    } catch (err) {
      if (isDuplicate(err)) return res.status(409).json({ error: 'You already have a folder with that name.', field: 'name' });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/me/folders/:id
 *
 * Deletes the folder only. The judgments in it stay saved (and keep their
 * notes); they just stop being filed there. Losing research because a folder
 * was tidied away would be a nasty surprise.
 */
workspaceRouter.delete('/folders/:id', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Folder not found.' });
    const userId = req.user!._id;
    const folderId = new ObjectId(req.params.id);
    const { deletedCount } = await folders.deleteOne({ _id: folderId, userId });
    if (!deletedCount) return res.status(404).json({ error: 'Folder not found.' });
    await savedCases.updateMany({ userId, folderIds: folderId }, { $pull: { folderIds: folderId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
