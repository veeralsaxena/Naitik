import { BrowserRouter, Route, Routes } from 'react-router-dom';

import CollectionPage from './pages/CollectionPage';
import ReviewPage from './pages/ReviewPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CollectionPage />} />
        <Route path="/review" element={<ReviewPage />} />
      </Routes>
    </BrowserRouter>
  );
}
