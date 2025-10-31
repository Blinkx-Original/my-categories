'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface TabConfig {
  key: string;
  label: string;
  href?: string;
}

const TABS: TabConfig[] = [
  { key: 'connectivity', label: 'Connectivity', href: '/admin' },
  { key: 'publishing', label: 'Publishing' },
  { key: 'categories', label: 'Categories' },
  { key: 'edit-product', label: 'Edit Product' },
  { key: 'edit-blog', label: 'Edit Blog' },
  { key: 'seo', label: 'SEO' },
  { key: 'assets', label: 'Assets' },
];

export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="admin-tabs">
      {TABS.map((tab) => {
        const isActive = tab.href
          ? pathname === tab.href || pathname === `${tab.href}/`
          : false;

        if (!tab.href) {
          return (
            <span key={tab.key} className="admin-tab admin-tab-disabled">
              {tab.label}
            </span>
          );
        }

        const className = `admin-tab${isActive ? ' admin-tab-active' : ''}`;
        return (
          <Link key={tab.key} href={tab.href} className={className} prefetch={false}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
