import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AuthedRequest, toPublicUser } from '../middleware/auth';
import { UserRow } from '../types/models';

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(4).max(64),
  fullName: z.string().trim().min(2).max(80),
  licensePlate: z.string().trim().min(4).max(20),
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const topupSchema = z.object({
  amount: z.number().int().min(10000).max(10000000),
});

function generateUid(db: DatabaseSync): string {
  for (let i = 0; i < 10; i++) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const uid = `UID-${suffix}`;
    const existing = db.prepare('SELECT id FROM users WHERE uid = ?').get(uid);
    if (!existing) return uid;
  }
  return `UID-${Date.now().toString(36).toUpperCase()}`;
}

export function createAuthRouter(
  db: DatabaseSync,
  jwtSecret: string,
  requireAuth: ReturnType<typeof import('../middleware/auth').createAuthMiddleware>,
) {
  const router = Router();

  router.post('/register', (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dữ liệu đăng ký không hợp lệ', details: parsed.error.flatten() });
      return;
    }

    const { username, password, fullName, licensePlate } = parsed.data;
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const uid = generateUid(db);
    const now = new Date().toISOString();

    const result = db
      .prepare(
        `INSERT INTO users (username, password_hash, full_name, role, uid, license_plate, wallet_balance, created_at)
         VALUES (?, ?, ?, 'USER', ?, ?, 200000, ?)`,
      )
      .run(username, passwordHash, fullName, uid, licensePlate.toUpperCase(), now);

    const userRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as unknown as UserRow;

    const token = jwt.sign(
      { userId: userRow.id, role: userRow.role, uid: userRow.uid },
      jwtSecret,
      { expiresIn: '7d' },
    );

    res.status(201).json({
      token,
      user: toPublicUser(userRow),
    });
  });

  router.post('/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
      return;
    }

    const { username, password } = parsed.data;
    const userRow = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as unknown as UserRow | undefined;

    if (!userRow || !bcrypt.compareSync(password, userRow.password_hash)) {
      res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
      return;
    }

    const token = jwt.sign(
      { userId: userRow.id, role: userRow.role, uid: userRow.uid },
      jwtSecret,
      { expiresIn: '7d' },
    );

    res.json({
      token,
      user: toPublicUser(userRow),
    });
  });

  router.get('/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.currentUser });
  });

  router.post('/wallet/topup', requireAuth, (req: AuthedRequest, res) => {
    const parsed = topupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Số tiền nạp phải từ 10.000đ đến 10.000.000đ' });
      return;
    }

    db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(
      parsed.data.amount,
      req.auth!.userId,
    );

    const updated = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(req.auth!.userId) as unknown as UserRow;

    res.json({ user: toPublicUser(updated) });
  });

  return router;
}
