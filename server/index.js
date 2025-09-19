import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Prevent caching on all API endpoints
app.use('/api', (req, res, next) => {
	res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
	res.set('Pragma', 'no-cache');
	res.set('Expires', '0');
	next();
});

let db;
const sessionRotators = new Map(); // sessionId -> intervalId

async function initDb() {
	const dbConn = await open({ filename: path.join(__dirname, 'data.sqlite'), driver: sqlite3.Database });
	await dbConn.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE IF NOT EXISTS classes (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			instructor_code TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS students (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			class_id TEXT NOT NULL,
			FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			class_id TEXT NOT NULL,
			start_ts INTEGER NOT NULL,
			end_ts INTEGER NOT NULL,
			rotating_key TEXT NOT NULL,
			rotating_updated_ts INTEGER NOT NULL DEFAULT 0,
			prev_rotating_key TEXT,
			prev_rotating_updated_ts INTEGER,
			FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS attendance (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			student_id TEXT NOT NULL,
			scan_ts INTEGER NOT NULL,
			FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
			FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
			UNIQUE(session_id, student_id)
		);
	`);
	try { await dbConn.exec('ALTER TABLE sessions ADD COLUMN prev_rotating_key TEXT'); } catch {}
	try { await dbConn.exec('ALTER TABLE sessions ADD COLUMN prev_rotating_updated_ts INTEGER'); } catch {}
	try { await dbConn.exec('ALTER TABLE sessions ADD COLUMN rotating_updated_ts INTEGER NOT NULL DEFAULT 0'); } catch {}
	return dbConn;
}

function nowMs() { return Date.now(); }
function addMinutes(ts, minutes) { return ts + minutes * 60 * 1000; }

function startSessionRotation(sessionId, endTs) {
	if (sessionRotators.has(sessionId)) return;
	const rotate = async () => {
		try {
			const s = await db.get('SELECT id, rotating_key, rotating_updated_ts, end_ts FROM sessions WHERE id = ?', [sessionId]);
			if (!s) { clearInterval(intervalId); sessionRotators.delete(sessionId); return; }
			if (nowMs() > s.end_ts) { clearInterval(intervalId); sessionRotators.delete(sessionId); return; }
			const newKey = uuidv4();
			await db.run('UPDATE sessions SET prev_rotating_key = ?, prev_rotating_updated_ts = ?, rotating_key = ?, rotating_updated_ts = ? WHERE id = ?', [s.rotating_key, s.rotating_updated_ts, newKey, nowMs(), sessionId]);
		} catch {}
	};
	const intervalId = setInterval(rotate, 40000);
	sessionRotators.set(sessionId, intervalId);
}

// Create class (instructor setup)
app.post('/api/classes', async (req, res) => {
	const { name, instructorCode, id } = req.body;
	if (!name || !instructorCode) return res.status(400).json({ error: 'name and instructorCode required' });
	// Use provided ID or generate UUID as fallback
	const classId = id || uuidv4();
	await db.run('INSERT INTO classes (id, name, instructor_code) VALUES (?, ?, ?)', [classId, name, instructorCode]);
	res.json({ id: classId, name });
});

// DEV SEED
app.get('/api/dev/seed', async (req, res) => {
	try {
		const classId = 'vitbclass123';
		await db.run('INSERT INTO classes (id, name, instructor_code) VALUES (?, ?, ?)', [classId, 'CS101 Demo', 'teach123']);
		res.json({ ok: true, classId, instructorCode: 'teach123', message: 'Class created. Use CSV import to add students.' });
	} catch (e) { res.status(500).json({ error: 'seed failed', detail: String(e) }); }
});

// DEV: List all classes (for debugging)
app.get('/api/dev/classes', async (req, res) => {
	try {
		const classes = await db.all('SELECT id, name, instructor_code FROM classes');
		res.json({ classes });
	} catch (e) { res.status(500).json({ error: 'failed to list classes', detail: String(e) }); }
});

// Instructor login -> JWT
app.post('/api/instructor/login', async (req, res) => {
	const { classId, instructorCode } = req.body;
	const cls = await db.get('SELECT * FROM classes WHERE id = ?', [classId]);
	if (!cls || cls.instructor_code !== instructorCode) return res.status(401).json({ error: 'invalid credentials' });
	const token = jwt.sign({ role: 'instructor', classId }, JWT_SECRET, { expiresIn: '8h' });
	res.json({ token });
});

// Student login -> validate exists
app.post('/api/student/login', async (req, res) => {
	const { studentId } = req.body;
	const student = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
	if (!student) return res.status(404).json({ error: 'student not found' });
	res.json({ studentId: student.id, name: student.name, classId: student.class_id });
});

// Import students from CSV
app.post('/api/instructor/import-students', upload.single('csvFile'), async (req, res) => {
	try {
		const { classId, token } = req.body;
		if (!classId || !token) return res.status(400).json({ error: 'missing classId or token' });
		
		// Verify instructor token
		let decoded;
		try { decoded = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'invalid token' }); }
		if (decoded.role !== 'instructor' || decoded.classId !== classId) return res.status(401).json({ error: 'unauthorized' });
		
		// Verify class exists
		const cls = await db.get('SELECT * FROM classes WHERE id = ?', [classId]);
		if (!cls) return res.status(404).json({ error: 'class not found' });
		
		if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
		
		// Read and parse CSV file from buffer
		const fileContent = req.file.buffer.toString('utf8');
		const records = parse(fileContent, { 
			columns: true, 
			skip_empty_lines: true,
			trim: true
		});
		
		if (!records.length) return res.status(400).json({ error: 'CSV file is empty or invalid' });
		
		// Validate CSV structure - check if first record has required columns
		const firstRecord = records[0];
		const hasId = firstRecord.hasOwnProperty('id') || firstRecord.hasOwnProperty('ID') || firstRecord.hasOwnProperty('Id');
		const hasName = firstRecord.hasOwnProperty('name') || firstRecord.hasOwnProperty('NAME') || firstRecord.hasOwnProperty('Name');
		
		if (!hasId || !hasName) {
			return res.status(400).json({ error: 'CSV must have columns: id, name (case insensitive)' });
		}
		
		// Import students
		let importedCount = 0;
		for (const record of records) {
			// Handle different column name cases
			const id = record.id || record.ID || record.Id;
			const name = record.name || record.NAME || record.Name;
			
			if (!id || !name) continue; // Skip rows with missing data
			
			try {
				await db.run('INSERT OR REPLACE INTO students (id, name, class_id) VALUES (?, ?, ?)', [id.toString().trim(), name.toString().trim(), classId]);
				importedCount++;
			} catch (error) {
				console.error(`Error importing student ${id}:`, error);
				// Continue with other students even if one fails
			}
		}
		
		res.json({ success: true, count: importedCount, message: `Successfully imported ${importedCount} students` });
		
	} catch (error) {
		console.error('CSV import error:', error);
		res.status(500).json({ error: 'Import failed', detail: error.message });
	}
});

// Start session (instructor)
app.post('/api/sessions/start', async (req, res) => {
	const { classId, token } = req.body;
	try { jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'unauthorized' }); }
	const sessionId = uuidv4();
	const start = nowMs();
	const end = addMinutes(start, 90);
	const rotatingKey = uuidv4();
	await db.run('INSERT INTO sessions (id, class_id, start_ts, end_ts, rotating_key, rotating_updated_ts, prev_rotating_key, prev_rotating_updated_ts) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)', [sessionId, classId, start, end, rotatingKey, nowMs()]);
	startSessionRotation(sessionId, end);
	res.json({ sessionId, classId, start, end });
});

// Optional: key-sync from instructor app
app.post('/api/sessions/key-sync', async (req, res) => {
	const { sessionId, currentKey, currentKeyTimestamp } = req.body;
	if (!sessionId || !currentKey || !currentKeyTimestamp) return res.status(400).json({ error: 'missing fields' });
	const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
	if (!session) return res.status(404).json({ error: 'session not found' });
	const ts = typeof currentKeyTimestamp === 'string' ? Date.parse(currentKeyTimestamp) : Number(currentKeyTimestamp);
	if (!Number.isFinite(ts)) return res.status(400).json({ error: 'bad timestamp' });
	if (ts <= (session.rotating_updated_ts || 0) && currentKey === session.rotating_key) return res.json({ ok: true, noop: true });
	await db.run('UPDATE sessions SET prev_rotating_key = ?, prev_rotating_updated_ts = ?, rotating_key = ?, rotating_updated_ts = ? WHERE id = ?', [session.rotating_key, session.rotating_updated_ts, currentKey, ts, sessionId]);
	res.json({ ok: true });
});

// Get active session for a class (if any)
app.get('/api/classes/:classId/active-session', async (req, res) => {
	const now = nowMs();
	const row = await db.get('SELECT * FROM sessions WHERE class_id = ? AND start_ts <= ? AND end_ts >= ? ORDER BY start_ts DESC LIMIT 1', [req.params.classId, now, now]);
	if (!row) return res.json({ active: false });
	startSessionRotation(row.id, row.end_ts);
	res.json({ active: true, sessionId: row.id, start: row.start_ts, end: row.end_ts });
});

// Get current QR data (does not rotate key)
app.post('/api/sessions/qr', async (req, res) => {
	const { sessionId } = req.body;
	const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
	if (!session) return res.status(404).json({ error: 'session not found' });
	if (nowMs() > session.end_ts) return res.status(400).json({ error: 'session ended' });
	const payload = { sessionId, key: session.rotating_key, ts: nowMs() };
	const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '3h', noTimestamp: true });
	const dataUrl = await QRCode.toDataURL(JSON.stringify({ t: token }));
	res.json({ dataUrl, payloadExpSec: 10800, keyPreview: session.rotating_key.slice(0, 8), refreshedAt: session.rotating_updated_ts, currentKey: session.rotating_key, keyTs: session.rotating_updated_ts });
});

// Student submit attendance (offline sync)
app.post('/api/attendance', async (req, res) => {
	const { studentId, token, scanTs } = req.body;
	if (!studentId || !token || !scanTs) return res.status(400).json({ error: 'missing fields' });
	let decoded;
	try { decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }); }
	catch { try { decoded = JSON.parse(token); } catch { return res.status(400).json({ error: 'invalid token' }); } }
	const { sessionId, key } = decoded;
	const student = await db.get('SELECT * FROM students WHERE id = ?', [studentId]);
	if (!student) return res.status(404).json({ error: 'student not found' });
	const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
	if (!session) return res.status(409).json({ error: 'session not yet synced' });
	// Strict 40-second sliding window: only accept keys within 40s of scan time
	const now = nowMs();
	let keyTs = null;
	if (key === session.rotating_key) keyTs = session.rotating_updated_ts;
	else if (session.prev_rotating_key && key === session.prev_rotating_key) keyTs = session.prev_rotating_updated_ts || 0;
	else return res.status(400).json({ error: 'stale token' });
	
	// Check if key is within 40 seconds of scan time (not key generation time)
	if ((Number(scanTs) - Number(keyTs)) > 40000) return res.status(400).json({ error: 'stale token' });
	
	// Additional check: ensure the key is not older than 40 seconds from current time
	if ((now - Number(keyTs)) > 40000) return res.status(400).json({ error: 'stale token' });
	if (scanTs < session.start_ts || scanTs > session.end_ts) return res.status(400).json({ error: 'outside session window' });
	try {
		await db.run('INSERT INTO attendance (id, session_id, student_id, scan_ts) VALUES (?, ?, ?, ?)', [uuidv4(), sessionId, studentId, scanTs]);
		return res.json({ ok: true });
	} catch (e) {
		if (String(e).includes('UNIQUE')) return res.json({ ok: true, duplicate: true });
		return res.status(500).json({ error: 'db error' });
	}
});

// Basic reports
app.get('/api/classes/:classId/attendance/:sessionId', async (req, res) => {
	const rows = await db.all('SELECT a.student_id, s.name, a.scan_ts FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.session_id = ? ORDER BY a.scan_ts ASC', [req.params.sessionId]);
	res.json(rows);
});

// CSV export
app.get('/api/classes/:classId/attendance/:sessionId/export.csv', async (req, res) => {
	const classId = req.params.classId;
	const sessionId = req.params.sessionId;
	const rows = await db.all('SELECT a.student_id AS id, s.name AS name, a.scan_ts AS timestamp FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.session_id = ? ORDER BY a.scan_ts ASC', [sessionId]);
	res.setHeader('Content-Type', 'text/csv; charset=utf-8');
	res.setHeader('Content-Disposition', `attachment; filename=attendance_${classId}_${sessionId}.csv`);
	// UTF-8 BOM for Excel
	res.write('\uFEFF');
	// Single-column CSV that matches the UI text exactly
	res.write('text\r\n');
	res.write(`Total: ${rows.length}\r\n`);
	for (const r of rows) {
		const name = String(r.name || '').replace(/"/g, '""');
		res.write(`"${r.id} - ${name}"\r\n`);
	}
	res.end();
});

// Static apps
app.use('/instructor', express.static(path.join(__dirname, '../instructor-app')));
app.use('/student', express.static(path.join(__dirname, '../student-app')));

app.get('/', (req, res) => {
	res.send('<h2>Attendance System</h2><ul><li><a href=\"/instructor\">Instructor App</a></li><li><a href=\"/student\">Student App</a></li></ul>');
});

(async () => {
	db = await initDb();
	app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
})();
