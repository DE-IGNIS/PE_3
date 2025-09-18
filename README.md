# Attendance System (Offline QR)

Quick Start

1. Install Node.js 18+.
2. Install deps:
   - Windows CMD: `npm install`
3. Start server:
   - `npm start`
4. Seed demo data:
   - Open `http://localhost:3000/api/dev/seed` and note `classId` and `instructorCode`.
5. Open apps:
   - Instructor: `http://localhost:3000/instructor`
   - Student: `http://localhost:3000/student`

Usage
- Instructor: Login with `classId` and `instructorCode`. Optionally import CSV with columns `id,name`. Start session to show rotating QR.
- Student: Login with your `studentId` (from seed or CSV). Tap Scan and point camera at instructor QR. Works offline; sync happens automatically when back online.

Tech
- Node/Express + SQLite (file `server/data.sqlite`).
- PWA static apps served by the same server.
- QR payload signed with JWT; rotation ~60s.
