import React, { forwardRef } from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  showCharCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, showCharCount, id, value, maxLength, className = '', ...props }, ref) => {
    const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const currentLength = typeof value === 'string' ? value.length : 0;

    return (
      <div className="w-full space-y-1.5">
        <div className="flex items-center justify-between">
          {label && (
            <label
              htmlFor={textareaId}
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 tracking-tight"
            >
              {label}
              {props.required && <span className="text-rose-500 dark:text-rose-400 ml-1">*</span>}
            </label>
          )}
          {showCharCount && maxLength && (
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
              {currentLength}/{maxLength}
            </span>
          )}
        </div>
        <textarea
          id={textareaId}
          ref={ref}
          value={value}
          maxLength={maxLength}
          rows={props.rows || 4}
          className={`w-full rounded-lg bg-white dark:bg-[#111827] border text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all duration-150 p-3 ${
            error
              ? 'border-rose-300 dark:border-rose-500/60 focus:border-rose-500 dark:focus:border-rose-400 focus:ring-rose-500/20'
              : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 focus:border-blue-600 dark:focus:border-blue-400 focus:ring-blue-600/20 dark:focus:ring-blue-400/20'
          } focus:outline-none focus:ring-3 disabled:bg-slate-50 dark:disabled:bg-slate-900/60 disabled:text-slate-500 disabled:cursor-not-allowed ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{error}</p>}
        {!error && helperText && <p className="text-xs text-slate-500 dark:text-slate-400">{helperText}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
