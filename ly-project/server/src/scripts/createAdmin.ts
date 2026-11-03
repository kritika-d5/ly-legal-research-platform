/**
 * Create the first admin account, or promote an existing account to admin.
 *
 *   npm run create-admin -- --email you@example.com --name "Your Name"
 *
 * The password is typed at a hidden prompt rather than passed as an argument,
 * so it never lands in shell history. Admins cannot be created through the
 * website on purpose: anyone could otherwise sign up and approve themselves.
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { client, users } from '../config.js';
import { hashPassword } from '../lib/auth.js';
import { emailSchema, ensureUserIndexes, passwordSchema } from '../lib/users.js';

/**
 * Hidden prompts. Lines are queued as they arrive rather than read with
 * rl.question(): when input is piped, every line can arrive before the first
 * question is asked, and rl.question() would silently drop them.
 */
function hiddenPrompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  // readline echoes keystrokes through _writeToOutput; swallow them so the
  // password is not shown on screen.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};

  const lines: string[] = [];
  let waiting: ((line: string) => void) | null = null;
  rl.on('line', (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      lines.push(line);
    }
  });

  return {
    ask(question: string) {
      process.stdout.write(question);
      return new Promise<string>((resolve) => {
        const done = (line: string) => {
          process.stdout.write('\n');
          resolve(line);
        };
        const queued = lines.shift();
        if (queued !== undefined) done(queued);
        else waiting = done;
      });
    },
    close: () => rl.close(),
  };
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  const email = emailSchema.safeParse(values.email ?? '');
  if (!email.success) {
    console.error('Usage: npm run create-admin -- --email you@example.com --name "Your Name"');
    process.exit(1);
  }

  await client.connect();
  await ensureUserIndexes();

  const existing = await users.findOne({ email: email.data });
  if (existing) {
    await users.updateOne(
      { _id: existing._id },
      { $set: { role: 'admin', verification: { status: 'not_required' }, updatedAt: new Date() } },
    );
    console.log(`✓ ${email.data} already had an account (${existing.role}); it is now an admin.`);
    console.log('  Its password is unchanged.');
    return;
  }

  const name = (values.name ?? '').trim();
  if (name.length < 2) {
    console.error('A new account needs a name: --name "Your Name"');
    process.exit(1);
  }

  const prompt = hiddenPrompter();
  const password = await prompt.ask('Password for the new admin (min 8 characters): ');
  const again = await prompt.ask('Type it again: ');
  prompt.close();
  const valid = passwordSchema.safeParse(password);
  if (!valid.success) {
    console.error(valid.error.issues[0].message);
    process.exit(1);
  }
  if (again !== password) {
    console.error('Passwords did not match.');
    process.exit(1);
  }

  const now = new Date();
  await users.insertOne({
    email: email.data,
    name,
    passwordHash: await hashPassword(password),
    role: 'admin',
    details: {},
    verification: { status: 'not_required' },
    tokenVersion: 0,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`✓ Admin account created for ${email.data}. Log in at /login.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.close());
