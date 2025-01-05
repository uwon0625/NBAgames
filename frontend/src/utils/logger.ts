export const logger = {
  debug: (...args: any[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(...args);
    }
  },
  error: (...args: any[]) => {
    console.error(...args);
  }
}; 