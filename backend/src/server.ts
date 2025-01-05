import app from './app';
import { logger } from './config/logger';

const port = process.env.PORT || 3001;

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
}); 