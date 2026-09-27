import { createRoot } from 'react-dom/client';
import '@blocknote/mantine/style.css';
import './styles.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
