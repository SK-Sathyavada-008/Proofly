import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className = '' }) => {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 ${className}`}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <React.Fragment key={index}>
            {index > 0 && <ChevronRight size={13} className="text-slate-400 dark:text-slate-600 shrink-0" />}
            {isLast || !item.href ? (
              <span className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-xs">
                {item.label}
              </span>
            ) : (
              <Link
                to={item.href}
                className="hover:text-slate-800 dark:hover:text-slate-200 transition-colors duration-150 truncate max-w-xs cursor-pointer"
              >
                {item.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
