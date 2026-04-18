import { BrowserRouter, Route, Routes } from 'react-router-dom';

import ThemeToggle from './components/ThemeToggle';
import CollectionPage from './pages/CollectionPage';
import ReviewPage from './pages/ReviewPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeToggle />
      <Routes>
        <Route path="/" element={<CollectionPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  );
}
