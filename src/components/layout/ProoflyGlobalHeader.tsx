import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Check, Sun, Moon } from 'lucide-react';
import { useProoflyAuth } from '../../context/ProoflyAuthContext';
import { useTheme } from '../../context/ThemeContext';

export const ProoflyGlobalHeader: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    currentUser,
    activeOrganization,
    userOrganizations,
    switchOrganization,
    loginDemoUser,
  } = useProoflyAuth();
  const { theme, toggleTheme } = useTheme();

  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOrgDropdownOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOrgDropdownOpen(false);
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const navItems = [
    { label: 'Organizer', to: '/organizer', match: /^\/organizer/ },
    { label: 'Judge', to: '/judge/assignments', match: /^\/judge/ },
    { label: 'Submit', to: '/submit', match: /^\/(submit|p)/ },
    { label: 'Leaderboard', to: '/leaderboard', match: /^\/leaderboard/ },
    { label: 'AI Runtime', to: '/ai-test', match: /^\/ai-test/ },
  ];

  const isJudgePersona = currentUser?.uid === 'user-judge-demo';
  const initials = isJudgePersona ? 'JD' : 'OR';
  const isDark = theme === 'dark';

  return (
    <header className="sticky top-0 z-40 w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
        {/* Left: Brand & Organization Switcher */}
        <div className="flex items-center gap-2.5 shrink-0 min-w-0">
          <NavLink to="/" className="flex items-center gap-2 group rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <div className="w-7 h-7 rounded-md bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white font-semibold text-xs shadow-xs group-hover:bg-blue-700 dark:group-hover:bg-blue-400 transition-colors duration-150">
              P
            </div>
            <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 tracking-tight">
              Proofly
            </span>
          </NavLink>

          <span className="text-slate-300 dark:text-slate-700 text-sm hidden sm:inline select-none">/</span>

          {/* Organization Dropdown */}
          <div className="relative hidden sm:block" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsOrgDropdownOpen(!isOrgDropdownOpen)}
              aria-expanded={isOrgDropdownOpen}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors duration-150 cursor-pointer"
            >
              <span className="truncate max-w-[160px] md:max-w-[200px]">
                {activeOrganization?.name || 'Organization'}
              </span>
              <ChevronDown
                size={13}
                className={`text-slate-400 dark:text-slate-500 shrink-0 transition-transform duration-150 ${
                  isOrgDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isOrgDropdownOpen && (
              <div className="proofly-dropdown-left absolute left-0 mt-1.5 w-64 rounded-lg bg-white dark:bg-[#161F30] border border-slate-200 dark:border-slate-700/80 shadow-lg dark:shadow-black/40 py-1 z-50">
                <div className="px-3 py-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                  Organizations
                </div>
                {userOrganizations.map((org) => {
                  const isSelected = org.id === activeOrganization?.id;
                  return (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => {
                        switchOrganization(org.id);
                        setIsOrgDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors duration-150 cursor-pointer ${
                        isSelected
                          ? 'bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100 font-medium'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      <span className="truncate">{org.name}</span>
                      {isSelected && <Check size={13} className="text-blue-600 dark:text-blue-400 shrink-0 ml-2" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Center: Primary Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = item.match.test(location.pathname);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/70 dark:hover:bg-slate-800/60'
                }`}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Right: Theme Toggle & User Switcher */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-8 h-8 rounded-md flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all duration-150 cursor-pointer"
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-0.5 hidden sm:block" />

          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
              aria-expanded={isUserDropdownOpen}
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 cursor-pointer"
            >
              <div className="w-6 h-6 rounded-full bg-slate-800 dark:bg-slate-700 text-white flex items-center justify-center font-medium text-[11px] ring-1 ring-slate-900/5 dark:ring-slate-600">
                {initials}
              </div>
              <span className="hidden sm:inline text-xs font-medium text-slate-700 dark:text-slate-300">
                {isJudgePersona ? 'Judge' : (currentUser?.displayName || 'Organizer')}
              </span>
              <ChevronDown
                size={12}
                className={`text-slate-400 dark:text-slate-500 transition-transform duration-150 ${
                  isUserDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isUserDropdownOpen && (
              <div className="proofly-dropdown absolute right-0 mt-1.5 w-56 rounded-lg bg-white dark:bg-[#161F30] border border-slate-200 dark:border-slate-700/80 shadow-lg dark:shadow-black/40 py-1 z-50">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                    {currentUser?.displayName}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {currentUser?.email}
                  </p>
                </div>
                <div className="py-1">
                  <div className="px-3 py-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    Switch role
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      loginDemoUser('organizer');
                      setIsUserDropdownOpen(false);
                      navigate('/organizer');
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors duration-150 cursor-pointer"
                  >
                    <span>Organizer</span>
                    {!isJudgePersona && <Check size={13} className="text-blue-600 dark:text-blue-400" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      loginDemoUser('judge');
                      setIsUserDropdownOpen(false);
                      navigate('/judge/assignments');
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors duration-150 cursor-pointer"
                  >
                    <span>Judge</span>
                    {isJudgePersona && <Check size={13} className="text-blue-600 dark:text-blue-400" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden flex items-center gap-1 border-t border-slate-100 dark:border-slate-800 px-3 py-1.5 bg-white dark:bg-slate-900 overflow-x-auto">
        {navItems.map((item) => {
          const isActive = item.match.test(location.pathname);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
                isActive
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {item.label}
            </NavLink>
          );
        })}
      </div>
    </header>
  );
};
