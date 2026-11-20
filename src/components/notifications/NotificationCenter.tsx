// ─────────────────────────────────────────────
// NotificationCenter.tsx — Phase 14 In-App Notification Center
// Proofly — Bell trigger, unread badges, event-driven alerts & quick navigation
// ─────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  Trophy,
  Clock,
  Sparkles,
  MessageSquare,
  FileText,
  Megaphone,
} from 'lucide-react';
import { notificationService } from '../../services/notificationService';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import type { AppNotification, NotificationEventType } from '../../types/appealsAndNotifications';

export const NotificationCenter: React.FC = () => {
  const { currentUser } = useProoflyAuth();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread'>('all');

  const containerRef = useRef<HTMLDivElement>(null);

  const recipientId = currentUser?.uid || currentUser?.email || 'guest';

  const loadNotifications = useCallback(async () => {
    if (!recipientId || recipientId === 'guest') return;
    try {
      const res = await notificationService.listNotifications({
        recipientId,
        limit: 30,
      });
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      console.warn('Could not load notifications:', err);
    }
  }, [recipientId]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 15000); // Polling every 15s
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleMarkAsRead = async (notif: AppNotification, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (notif.isRead) return;
    try {
      await notificationService.markAsRead(notif.id, recipientId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err) {
      console.warn('Error marking notification read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead(recipientId);
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true, readAt: now })));
      setUnreadCount(0);
    } catch (err) {
      console.warn('Error marking all notifications read:', err);
    }
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    await handleMarkAsRead(notif);
    setIsOpen(false);
    if (notif.actionUrl) {
      navigate(notif.actionUrl);
    }
  };

  const getEventIcon = (type: NotificationEventType) => {
    switch (type) {
      case 'RESULTS_PUBLICATION':
        return <Trophy size={14} className="text-amber-500 shrink-0" />;
      case 'SUBMISSION_CONFIRMATION':
      case 'REGISTRATION_CONFIRMATION':
        return <Check size={14} className="text-emerald-500 shrink-0" />;
      case 'SUBMISSION_DEADLINE_REMINDER':
      case 'EVALUATION_DEADLINE':
        return <Clock size={14} className="text-rose-500 shrink-0" />;
      case 'APPEAL_STATUS_CHANGE':
        return <MessageSquare size={14} className="text-indigo-500 shrink-0" />;
      case 'ORGANIZER_ANNOUNCEMENT':
        return <Megaphone size={14} className="text-blue-500 shrink-0" />;
      case 'JUDGE_ASSIGNMENT':
      case 'EVALUATION_COMPLETION':
        return <Sparkles size={14} className="text-purple-500 shrink-0" />;
      default:
        return <FileText size={14} className="text-slate-400 shrink-0" />;
    }
  };

  const formatTimestamp = (iso: string) => {
    try {
      const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diffSec < 60) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDays = Math.floor(diffHr / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  };

  const filtered = notifications.filter((n) => {
    if (activeFilter === 'unread') return !n.isRead;
    return true;
  });

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) loadNotifications();
        }}
        aria-label="Notifications"
        aria-expanded={isOpen}
        title="Notifications"
        className="relative w-8 h-8 rounded-md flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all duration-150 cursor-pointer"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[15px] h-[15px] px-1 text-[9px] font-bold text-white bg-blue-600 rounded-full ring-2 ring-white dark:ring-slate-900 animate-in zoom-in duration-150">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xl dark:shadow-black/60 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/80 dark:bg-blue-900/50 px-1.5 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  className="text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 cursor-pointer transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck size={12} />
                  <span>Mark all read</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-[11px]">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                activeFilter === 'all'
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('unread')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                activeFilter === 'unread'
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.length === 0 ? (
              <div className="py-10 text-center px-4">
                <Bell size={24} className="mx-auto text-slate-300 dark:text-slate-600 mb-2 stroke-[1.5]" />
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">No notifications</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {activeFilter === 'unread' ? 'All caught up! No unread alerts.' : 'You have no notifications yet.'}
                </p>
              </div>
            ) : (
              filtered.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`p-3 text-xs flex items-start gap-2.5 transition-colors cursor-pointer group ${
                    !n.isRead
                      ? 'bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/70 dark:hover:bg-blue-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {/* Icon */}
                  <div className="mt-0.5 p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800">
                    {getEventIcon(n.eventType)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`truncate font-semibold text-[12px] ${
                          !n.isRead ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {n.title}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                        {formatTimestamp(n.createdAt)}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {n.message}
                    </p>

                    {n.competitionTitle && (
                      <span className="inline-block text-[10px] font-medium text-slate-400 dark:text-slate-500 pt-0.5 truncate">
                        {n.competitionTitle}
                      </span>
                    )}
                  </div>

                  {/* Actions / Unread dot */}
                  <div className="flex flex-col items-center gap-1.5 pt-1 shrink-0">
                    {!n.isRead ? (
                      <span
                        title="Mark as read"
                        onClick={(e) => handleMarkAsRead(n, e)}
                        className="w-2 h-2 rounded-full bg-blue-600 group-hover:scale-125 transition-transform"
                      />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-transparent" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
