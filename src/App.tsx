import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ForgeProvider } from './forge/ForgeProvider';
import { AsksPage } from './pages/AsksPage';
import { LedgerPage } from './pages/LedgerPage';
import { CommitmentPage } from './pages/CommitmentPage';
import { DecisionsPage } from './pages/DecisionsPage';
import { TracePage } from './pages/TracePage';
import { IntakePage } from './pages/IntakePage';
import { MemoryPage } from './pages/MemoryPage';
import { SurfacesPage } from './pages/SurfacesPage';

/** Each page opens at its top; an anchor (#evidence) still scrolls to its section. */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <ForgeProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<AsksPage />} />
          <Route path="/commitments" element={<LedgerPage />} />
          <Route path="/c/:id" element={<CommitmentPage />} />
          <Route path="/decisions" element={<DecisionsPage />} />
          <Route path="/decisions/:ref" element={<TracePage />} />
          <Route path="/decisions/:ref/intake" element={<IntakePage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/surfaces" element={<SurfacesPage />} />
          <Route path="*" element={<AsksPage />} />
        </Routes>
      </BrowserRouter>
    </ForgeProvider>
  );
}
