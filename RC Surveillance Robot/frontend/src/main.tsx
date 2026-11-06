import {createRoot} from 'react-dom/client';
import './index.css';

const root = createRoot(document.getElementById('root')!);

if (import.meta.env.MODE === 'demo') {
  void import('./components/PublicDemoDashboard').then(({ PublicDemoDashboard }) => root.render(<PublicDemoDashboard contactUrl={import.meta.env.VITE_PROJECT_CONTACT_URL} />));
} else {
  void import('./App').then(({ default: App }) => root.render(<App />));
}
