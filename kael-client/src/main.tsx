import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ApplicationBoundary } from './components/ApplicationBoundary';
import './index.css';
createRoot(document.getElementById('root')!).render(<ApplicationBoundary><App /></ApplicationBoundary>);
