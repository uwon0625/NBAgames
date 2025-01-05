export const PageWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="container mx-auto px-4 py-8">
      {children}
    </div>
  );
}; 