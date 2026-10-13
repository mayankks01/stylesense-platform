# StyleSense AI prospecting platform

An incremental implementation of the ThinkDatax Full Stack + AI Engineer assignment: discover grounded leads, prepare outreach, send to controlled test recipients, track engagement, classify simulated replies, and rank prospects.

## Current status

Step 1 is complete: requirements and implementation plan. No application, database, provider integration, or deployment exists yet.

- [Requirements and acceptance criteria](docs/REQUIREMENTS.md)
- [Architecture and staged build plan](docs/BUILD_PLAN.md)
- [GitHub instructions for Step 1](docs/GITHUB.md)

The next step is project setup. Each stage will end with verification notes and its own Git commit instructions, followed by a pause for review.

## Planned stack

React with TypeScript and Vite for the console; Node.js with TypeScript and Express for the REST API; PostgreSQL with Prisma migrations for relational storage. A single TypeScript language across the application reduces switching overhead. Server sessions will protect application data. External email, search, and LLM services will sit behind interfaces with explicit mock modes.

## Scope decisions

- Include authentication: Section 3.1 requires it, despite the conflicting no-auth statement in Section 4.
- Finish core scope before optional queues, inbound email ingestion, click tracking, follow-up sequences, or a second database.
- Use only controlled recipient addresses or provider sandbox recipients for demonstrations. Researching a prospect is not permission to contact them.
- Treat submission instructions in the PDF as deliverable context; this project does not automatically email the assignment reviewer.
- Keep secrets in environment variables and never commit credentials, real lead exports, or private email content.

## Documentation to complete as implementation lands

Run commands, actual environment variable names, scoring configuration, API documentation, tests, measured classification accuracy, three research-grounded email examples, known limitations, and a 3–5 minute demo guide will be added in the relevant stages. No unrun evaluation result or simulated provider delivery will be presented as real.
