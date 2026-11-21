import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { DatabaseSync } from 'node:sqlite';
import { PublicUser, UserRole, UserRow } from '../types/models';

export interface AuthPayload {
  userId: number;
  role: UserRole;
  uid: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthPayload;
  currentUser?: PublicUser;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    uid: row.uid,
    licensePlate: row.license_plate,
    walletBalance: row.wallet_balance,
    createdAt: row.created_at,
  };
}

export function createAuthMiddleware(db: DatabaseSync, jwtSecret: string) {
  return function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Thiếu token xác thực' });
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = jwt.verify(token, jwtSecret) as AuthPayload;
      const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId) as UserRow | undefined;
      if (!userRow) {
        res.status(401).json({ error: 'Tài khoản không tồn tại' });
        return;
      }
      req.auth = {
        userId: userRow.id,
        role: userRow.role,
        uid: userRow.uid,
      };
      req.currentUser = toPublicUser(userRow);
      next();
    } catch {
      res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
  };
}

export function requireRole(role: UserRole) {
  return function roleGuard(req: AuthedRequest, res: Response, next: NextFunction): void {
    if (!req.auth) {
      res.status(401).json({ error: 'Chưa xác thực' });
      return;
    }
    if (req.auth.role !== role) {
      res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
      return;
    }
    next();
  };
}
