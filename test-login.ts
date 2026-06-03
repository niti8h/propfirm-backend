import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
  console.log("Recent users:", users.map(u => ({ email: u.email, hash: u.passwordHash.substring(0,10) + "...", suspended: u.isSuspended })));
}
main().catch(console.error);
