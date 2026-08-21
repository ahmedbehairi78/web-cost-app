import { Toaster } from 'react-hot-toast';
import { useLanguage } from '../context/LanguageContext';
import { isErpTheme } from '../lib/erpBrand';

export function ThemedToaster() {
  const { theme } = useLanguage();

  const style =
    theme === 'dark'
      ? { background: '#1f2937', color: '#f9fafb', borderRadius: '12px' }
      : isErpTheme(theme)
        ? {
            background: '#ffffff',
            color: '#2C3E50',
            borderRadius: '10px',
            border: '1px solid #C5D3DE',
            boxShadow: '0 4px 14px rgb(0 59 113 / 0.12)',
          }
        : theme === 'soft'
          ? {
              background: '#ffffff',
              color: '#37474f',
              borderRadius: '12px',
              border: '1px solid #cfd8dc',
              boxShadow: '0 4px 14px rgb(0 0 0 / 0.08)',
            }
          : {
              background: '#ffffff',
              color: '#111827',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 4px 6px rgb(0 0 0 / 0.07)',
            };

  return (
    <Toaster
      position="top-center"
      containerStyle={{ zIndex: 11050 }}
      toastOptions={{
        duration: 4000,
        style,
        success: { iconTheme: { primary: '#10b981', secondary: theme === 'dark' ? '#fff' : '#ffffff' } },
        error: { iconTheme: { primary: '#ef4444', secondary: theme === 'dark' ? '#fff' : '#ffffff' } },
      }}
    />
  );
}
