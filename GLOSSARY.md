# Glossary

Domain terms with one meaning across the extension, the web app and the worker.

- **Room**: the live, shared state behind one share link: its op list, peers and access. The `AnnotationRoom` Durable Object is its only writer.
- **View-only**: a link whose owner turned off editing, or a session opened with `?readonly=1`. The room refuses every write from it; the client never shows one.
- **Session rights**: what this browser session may do to the room, answered in one place (`apps/extension/lib/session-rights.ts`). `canWrite` covers adding marks, replies and reactions; `canTriage` adds status changes, verdicts and deletes, which a host can withhold (the widget does). Anyone who can write may delete any annotation: the server does not check authorship, so the client does not invent a rule it cannot enforce.
- **Triage**: changing an annotation's status, priority or assignee, giving a verdict on an agent's fix, or deleting it.
