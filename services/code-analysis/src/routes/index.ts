import { Application } from 'express';
import healthRoutes from './health.routes';

export const registerRoutes = (app: Application): void => {
  app.use('/health', healthRoutes);
};
