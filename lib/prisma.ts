import 'server-only';

import { getPrismaClient } from './server/tidb/client';

const prisma = getPrismaClient();

export default prisma;
