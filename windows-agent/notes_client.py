"""Fetch notes from Supabase and adapt them for ATS form questions."""
import anthropic
from logger import log


class NotesClient:
    def __init__(self, supabase_ops, api_key: str):
        self.db = supabase_ops
        self.claude = anthropic.Anthropic(api_key=api_key)

    def answer_question(self, question: str, job_title: str = "", company: str = "") -> str:
        """
        Given an ATS form question, find relevant notes and generate an answer.
        Never fabricates — only uses stories from the notes bank.
        """
        # Fetch all notes, scored by keyword relevance
        keywords = question.lower().split()
        notes = self.db.get_notes(keywords)

        if not notes:
            log.warning(f"No notes available to answer: {question}")
            return ""

        # Build context from top 3 most relevant notes
        context = "\n\n".join([
            f"[{n['category']}] {n['title']}:\n{n['story']}"
            for n in notes[:3]
        ])

        prompt = f"""You are answering an ATS application question for a job candidate.
Use ONLY the provided stories/notes below. Never fabricate experiences or skills not mentioned in the notes.

Job: {job_title} at {company}
Question: {question}

Candidate's Notes:
{context}

Rules:
- Under 400 words
- First person, past tense
- Professional tone
- Directly answer the question using the most relevant story
- If no story is relevant, return empty string

Answer:"""

        try:
            response = self.claude.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=600,
                messages=[{"role": "user", "content": prompt}]
            )
            answer = response.content[0].text.strip()

            # Mark the used notes
            for n in notes[:3]:
                self.db.mark_note_used(n["id"])

            return answer
        except Exception as e:
            log.error(f"Failed to generate answer: {e}")
            return ""
