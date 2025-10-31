import type { ReactNode } from 'react';

import AdminTabs from './admin-tabs';
import './admin.css';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <h1 className="admin-title">Panel de Administración</h1>
          <p className="admin-subtitle">
            Esta sección está protegida con Basic Auth. Usa las pestañas para diagnosticar
            conectividad y controlar la publicación hacia el sitio y Algolia.
          </p>
          <AdminTabs />
        </header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
