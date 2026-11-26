/**
 * 查找替换浮层。
 *
 * 只管显示与键盘，不持有搜索状态：命中由 Editor 按当前视图算好传进来，
 * 这样同一套 UI 在 WYSIWYG 与源码视图里都不用改。
 *
 * 键盘约定（与主流编辑器一致）：
 * - 输入框里 Enter / Shift+Enter 走下 / 上一个
 * - Esc 关闭并把焦点还给正文
 * - 替换框里 Enter 替换当前一处
 */
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { t } from "../i18n";

interface Props {
  query: string;
  onQueryChange(value: string): void;
  replaceText: string;
  onReplaceChange(value: string): void;
  showReplace: boolean;
  onToggleReplace(): void;
  caseSensitive: boolean;
  regex: boolean;
  onToggleCase(): void;
  onToggleRegex(): void;
  /** 命中总数与当前序号（0 起；无命中时传 -1）。 */
  total: number;
  current: number;
  truncated: boolean;
  /** "find.invalidRegex" 或空串。 */
  error: string;
  onNext(): void;
  onPrev(): void;
  onReplaceOne(): void;
  onReplaceAll(): void;
  onClose(): void;
  /** 每次自增即「请把焦点放回输入框」（重复按 ⌘F 时用）。 */
  focusToken: number;
}

export function FindBar({
  query,
  onQueryChange,
  replaceText,
  onReplaceChange,
  showReplace,
  onToggleReplace,
  caseSensitive,
  regex,
  onToggleCase,
  onToggleRegex,
  total,
  current,
  truncated,
  error,
  onNext,
  onPrev,
  onReplaceOne,
  onReplaceAll,
  onClose,
  focusToken,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦并全选：继续敲就是新查询，改一点就接着改
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusToken]);

  useEffect(() => {
    if (showReplace) replaceRef.current?.focus();
  }, [showReplace]);

  const count = (() => {
    if (error) return t("find.invalidRegex");
    if (!query) return "";
    if (total === 0) return t("find.noResults");
    const position = `${(current >= 0 ? current : 0) + 1}/${total}`;
    return truncated ? `${position}+` : position;
  })();

  return (
    <div className="find-bar" role="search" aria-label={t("find.open")}>
      <div className="find-card">
        <div className="find-row">
          <button
            type="button"
            className={`find-toggle ${showReplace ? "on" : ""}`}
            onClick={onToggleReplace}
            aria-pressed={showReplace}
            title={t("find.toggleReplace")}
            aria-label={t("find.toggleReplace")}
          >
            <Icon name="chevron" />
          </button>

          <input
            ref={inputRef}
            className="find-input"
            value={query}
            placeholder={t("find.placeholder")}
            aria-label={t("find.open")}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) onPrev();
                else onNext();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />

          <span className={`find-count ${total === 0 && query ? "empty" : ""}`} aria-live="polite">
            {count}
          </span>

          <button
            type="button"
            className="find-icon-btn"
            onClick={onPrev}
            title={t("find.prev")}
            aria-label={t("find.prev")}
            disabled={total === 0}
          >
            <Icon name="up" />
          </button>
          <button
            type="button"
            className="find-icon-btn"
            onClick={onNext}
            title={t("find.next")}
            aria-label={t("find.next")}
            disabled={total === 0}
          >
            <Icon name="dwn" />
          </button>

          <button
            type="button"
            className={`find-flag ${caseSensitive ? "on" : ""}`}
            onClick={onToggleCase}
            aria-pressed={caseSensitive}
            title={t("find.caseSensitive")}
            aria-label={t("find.caseSensitive")}
          >
            Aa
          </button>
          <button
            type="button"
            className={`find-flag ${regex ? "on" : ""}`}
            onClick={onToggleRegex}
            aria-pressed={regex}
            title={t("find.regex")}
            aria-label={t("find.regex")}
          >
            .*
          </button>

          <button
            type="button"
            className="find-icon-btn"
            onClick={onClose}
            title={t("find.close")}
            aria-label={t("find.close")}
          >
            <Icon name="close" />
          </button>
        </div>

        {showReplace && (
          <div className="find-row">
            <span className="find-spacer" />
            <input
              ref={replaceRef}
              className="find-input"
              value={replaceText}
              placeholder={t("find.replacePlaceholder")}
              aria-label={t("find.replacePlaceholder")}
              onChange={(e) => onReplaceChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onReplaceOne();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
            />
            <button
              type="button"
              className="find-btn"
              onClick={onReplaceOne}
              disabled={total === 0}
            >
              {t("find.replace")}
            </button>
            <button
              type="button"
              className="find-btn"
              onClick={onReplaceAll}
              disabled={total === 0}
            >
              {t("find.replaceAll")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
