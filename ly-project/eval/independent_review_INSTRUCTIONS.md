# Independent review task — 30 citations

You are the SECOND reviewer. A first reviewer has already judged these 30
records, but you are NOT being shown those verdicts, deliberately. Judge each
record on its own. Do not try to guess what the first reviewer said.

## The file

`independent_review_blank.json` — 30 records, each with:

  question_asked            the user's legal question
  claim_made_by_the_system  a sentence the AI answer asserted
  cited_case                the case the answer cited for it
  cited_passage             the FULL text of the passage it cited
  your_verdict              <- fill this in
  your_reason               <- fill this in, one or two sentences

## The only question

**Does `cited_passage` actually support `claim_made_by_the_system`?**

Not "is the passage relevant to the question". Not "is the claim good law".
Only: does this specific passage say this specific thing.

## The three verdicts

SUPPORTS  The passage states what the claim says, and the claim attributes it
          correctly. Quotes are accurate and in context.

PARTIAL   The substance is in the passage, but the claim either
            - adds a proposition the passage does not contain, or
            - gets the speaker wrong (presents a lawyer's submission as the
              court's holding, or a holding as a mere contention), or
            - lifts a quote out of a context that changes its meaning.

WRONG     The claim's content is not in the passage at all, or the passage
          says the opposite.

## Things to watch for

These are Indian court judgments. Within one judgment, several voices appear:

  the judge         "we are of the view", "we hold", "in our opinion"
  a lawyer          "it is submitted that", "learned counsel contended",
                    "it was urged on behalf of"
  a quoted case     text the court reproduces from an earlier judgment

**Who is speaking matters as much as what is said.** A lawyer's argument
presented as a court's ruling is WRONG, even when the words are quoted exactly.
Check the opening words of the passage before deciding.

Also check whether every part of the claim is in the passage. A claim can quote
one sentence accurately and then add a second proposition that appears nowhere.

## Output

Fill in `your_verdict` and `your_reason` for all 30. Save as
`independent_review_filled.json`. Do not change any other field.

Then report your totals: how many SUPPORTS, PARTIAL, WRONG.
