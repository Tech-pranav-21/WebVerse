# WebVerse

A collection of independent demo websites for students, college projects, and learning, each with its own source code, in one repository.

Every project is self-contained: its own dependencies, its own build, its own deployment. Nothing is shared between them.

| Project | Folder | Stack | Guide |
| --- | --- | --- | --- |
| SkillBridge: Student Skill Exchange Platform | [`Skill Exchange Platform/frontend`](./Skill%20Exchange%20Platform/frontend) | React 19, Vite, Tailwind CSS, React Router | [README](./Skill%20Exchange%20Platform/frontend/README.md) |
| RC Surveillance Robot: ESP32-CAM surveillance dashboard | [`RC Surveillance Robot`](./RC%20Surveillance%20Robot) | React 19, Vite, Tailwind CSS, Node (Groq) backend, Python (FastAPI, YOLOv8) service | [README](./RC%20Surveillance%20Robot/README.md) |

## Running a project

```bash
cd "<project folder>/frontend"
npm install
npm run dev
```

The RC Surveillance Robot also has a Node backend and a Python service for its AI features, and a hosted public demo that is separate from running it with a real camera. Its README explains both.

## Deploying a project

Deploy each project as its own site: point the host's Root Directory at the project's `frontend` folder. The RC Surveillance Robot ships a `vercel.json` for this and its README lists the steps.
