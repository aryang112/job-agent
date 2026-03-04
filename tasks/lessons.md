# Job Agent — Lessons Learned

> Update this file after ANY correction from the user.
> Format: pattern → rule to prevent recurrence.

## Workflow
- Always read CODEBASE.md before exploring the codebase to avoid wasting tokens
- Update tasks/todo.md after completing each item
- Update CODEBASE.md when architecture changes

## Code Patterns
- Use `supabaseAdmin` (service role) for all server-side operations
- Inline styles in page.tsx — use the `C` color object for consistency
- All API routes use Next.js App Router conventions (route.ts with named exports)
- Middleware exemptions for /api/scan must handle 3 auth methods (cookie, cron header, bearer)

## Gotchas
- (none yet)
