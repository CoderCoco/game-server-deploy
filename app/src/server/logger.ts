import winston from 'winston';

const isDev = process.env['NODE_ENV'] !== 'production';

export const logger = winston.createLogger({
  level: isDev ? 'debug' : 'info',
  format: isDev
    ? winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf((info) => {
          const { timestamp, level, message, ...meta } = info as Record<string, unknown>;
          const metaStr = Object.keys(meta).length
            ? '\n' + JSON.stringify(meta, null, 2)
            : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        }),
      )
    : winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
  transports: [new winston.transports.Console()],
});

/** Express request logger middleware */
export function requestLogger(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    logger.log(level, `${req.method} ${req.path}`, {
      status: res.statusCode,
      ms,
      query: Object.keys(req.query).length ? req.query : undefined,
    });
  });
  next();
}
