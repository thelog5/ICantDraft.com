// @ts-ignore - PrismaClient is generated at build time
import { PrismaClient } from '@prisma/client';

// Global PrismaClient instance for serverless environments
// In serverless (Vercel), we need to reuse the same instance across invocations
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Create PrismaClient with connection pooling configuration for serverless
function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
}

export const prisma = globalThis.prisma || createPrismaClient();

// In development, hot reload can create multiple instances
// In production (serverless), we reuse the global instance
if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Handle graceful shutdown
if (typeof process !== 'undefined') {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
}

// Add connection retry wrapper for common operations
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

export async function withRetry<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Only retry on connection errors (P1001, P1002, P1003, P1008, P1017)
    const isConnectionError = error?.code?.startsWith('P10') || 
                              error?.code === 'P1001' || 
                              error?.code === 'P1002' || 
                              error?.code === 'P1003' || 
                              error?.code === 'P1008' || 
                              error?.code === 'P1017';
    
    if (isConnectionError && retries > 0) {
      console.warn(`[Prisma] Connection error, retrying... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`, error?.code);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return withRetry(operation, retries - 1);
    }
    throw error;
  }
}

export default prisma;
