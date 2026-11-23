// Must stay first: it replaces blocked browser storage before any other module reads it.
import './lib/tab-storage';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
createRoot(document.getElementById('root')!).render(<App />);
