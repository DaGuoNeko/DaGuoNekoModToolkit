import React, { useEffect, useRef, useState, useId } from "react";

const paths = {
  skin: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 21v-3a7 7 0 0 1 14 0v3" />
    </>
  ),
  cube: (
    <>
      <path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8" />
    </>
  ),
  text: (
    <>
      <path d="M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3" />
    </>
  ),
  tools: (
    <>
      <path d="m14 6 4 4M10 14l-6 6-2-2 6-6M13 3a6 6 0 0 0 8 8l-4 4-8-8z" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z" />,
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7v.1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" />
    </>
  ),
  import: (
    <>
      <path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5" />
    </>
  ),
  arrow: <path d="m14 5-7 7 7 7" />,
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5" />
    </>
  ),
  edit: (
    <>
      <path d="m14 4 6 6M4 20l1-6L16 3l5 5-11 11z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6" />
    </>
  ),
  external: (
    <>
      <path d="M13 3h8v8m0-8L10 14M10 5H4v15h15v-6" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1" />
      <path d="m3 17 6-6 4 4 3-3 5 5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M19 5l-1 1M6 18l-1 1" />
    </>
  ),
  moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z" />,
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M12 17v4M8 21h8" />
    </>
  ),
};
export function Icon({ name, size = 18, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.cube}
    </svg>
  );
}
export function Button({
  icon,
  children,
  primary,
  danger,
  className = "",
  ...props
}) {
  return (
    <button
      className={`button ${primary ? "primary" : ""} ${danger ? "danger" : ""} ${!children ? "icon-button" : ""} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}

// The browser top layer keeps the menu above scrolling panels and modal content.
export function Select({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "请选择",
  className = "",
  ...labelProps
}) {
  const id = useId();
  const trigger = useRef(null);
  const menu = useRef(null);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selected = options.findIndex((option) => option.value === value);
  const enabled = options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);

  function position() {
    const rect = trigger.current.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const desiredHeight = Math.min(292, options.length * 36 + 12);
    const upward = below < desiredHeight && above > below;
    const height = Math.max(0, Math.min(desiredHeight, upward ? above : below));
    const context = document.createElement("canvas").getContext("2d");
    const font = getComputedStyle(trigger.current);
    context.font = `${font.fontSize} ${font.fontFamily}`;
    const labelWidth = Math.max(
      0,
      ...options.map((option) => context.measureText(option.label).width),
    );
    const width = Math.min(
      Math.max(rect.width, labelWidth + 76, 220),
      420,
      innerWidth - 24,
    );
    Object.assign(menu.current.style, {
      width: `${width}px`,
      maxHeight: `${height}px`,
      left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`,
      top: `${Math.max(12, Math.min(upward ? rect.top - height - 6 : rect.bottom + 6, innerHeight - height - 12))}px`,
    });
  }

  function close() {
    menu.current.hidePopover();
    setOpen(false);
    search.current = { text: "", time: 0 };
  }

  function expand(
    index = selected >= 0 && !options[selected].disabled
      ? selected
      : enabled[0],
  ) {
    if (trigger.current.matches(":disabled") || enabled.length === 0) return;
    position();
    setActive(index ?? -1);
    menu.current.showPopover();
    setOpen(true);
  }

  function choose(index) {
    if (!options[index] || options[index].disabled) return;
    close();
    trigger.current.focus();
    if (options[index].value !== value) onChange(options[index].value);
  }

  useEffect(() => {
    const popup = menu.current;
    const sync = (event) => {
      setOpen(event.newState === "open");
      if (event.newState === "closed") search.current = { text: "", time: 0 };
    };
    popup.addEventListener("toggle", sync);
    return () => popup.removeEventListener("toggle", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (
      disabled ||
      trigger.current.matches(":disabled") ||
      enabled.length === 0
    ) {
      close();
      return;
    }
    position();
    const reposition = (event) => {
      if (!menu.current.contains(event.target)) position();
    };
    const observer = new ResizeObserver(position);
    observer.observe(trigger.current);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", reposition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open, disabled, options.length]);

  useEffect(() => {
    if (open)
      menu.current
        .querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function keyDown(event) {
    const visible = menu.current.matches(":popover-open");
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const current = enabled.indexOf(active);
      const next =
        event.key === "Home"
          ? enabled[0]
          : event.key === "End"
            ? enabled.at(-1)
            : enabled[
                Math.max(
                  0,
                  Math.min(
                    enabled.length - 1,
                    current + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                )
              ];
      if (visible) setActive(next ?? -1);
      else
        expand(
          event.key === "Home"
            ? enabled[0]
            : event.key === "End"
              ? enabled.at(-1)
              : undefined,
        );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (visible) choose(active);
      else expand();
    } else if (event.key === "Escape" && visible) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      if (visible) close();
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.isComposing
    ) {
      const now = Date.now();
      const text =
        (now - search.current.time < 700 ? search.current.text : "") +
        event.key.toLowerCase();
      search.current = { text, time: now };
      const repeated = [...text].every((char) => char === text[0]);
      const prefix = repeated ? text[0] : text;
      const start = visible ? active : selected;
      const candidates = [
        ...enabled.filter((i) => i > start),
        ...enabled.filter((i) => i <= start),
      ];
      const match = candidates.find((i) =>
        String(options[i].label).toLowerCase().startsWith(prefix),
      );
      if (match !== undefined) {
        event.preventDefault();
        if (visible) setActive(match);
        else choose(match);
      }
    }
  }

  return (
    <div className={`select-control ${className}`}>
      <button
        {...labelProps}
        ref={trigger}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={
          open && active >= 0 ? `${id}-${active}` : undefined
        }
        className="select-trigger"
        disabled={disabled || enabled.length === 0}
        onClick={() =>
          menu.current.matches(":popover-open") ? close() : expand()
        }
        onKeyDown={keyDown}
        onBlur={(event) => {
          if (!menu.current.contains(event.relatedTarget)) close();
        }}
      >
        <span
          className={
            selected < 0 || options[selected].value === ""
              ? "select-placeholder"
              : ""
          }
          title={selected < 0 ? placeholder : options[selected].label}
        >
          {selected < 0 ? placeholder : options[selected].label}
        </span>
        <Icon name="down" size={16} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="listbox"
        className="select-menu"
        aria-label={labelProps["aria-label"]}
        aria-labelledby={labelProps["aria-labelledby"]}
      >
        {options.map((option, index) => (
          <div
            id={`${id}-${index}`}
            key={option.value}
            role="option"
            aria-selected={index === selected}
            aria-disabled={option.disabled || undefined}
            data-index={index}
            data-active={index === active}
            className="select-option"
            title={option.label}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => {
              if (!option.disabled) setActive(index);
            }}
            onClick={() => choose(index)}
          >
            <span>{option.label}</span>
            {index === selected && <Icon name="check" size={16} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = "" }) {
  const id = useId();
  const bind = (child) => {
    if (!React.isValidElement(child)) return child;
    if (
      ["input", "select", "textarea"].includes(child.type) ||
      child.type === Select
    )
      return React.cloneElement(child, {
        "aria-labelledby": id,
        "aria-describedby": hint ? id + "-hint" : undefined,
      });
    if (typeof child.type === "string" && child.props.children)
      return React.cloneElement(
        child,
        {},
        React.Children.map(child.props.children, bind),
      );
    return child;
  };
  return (
    <div className={`field ${className}`}>
      <span id={id}>{label}</span>
      {React.Children.map(children, bind)}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export function ErrorBox({ children }) {
  return children ? (
    <div className="error-box" role="alert">
      <Icon name="info" />
      <span>{children}</span>
    </div>
  ) : null;
}
export function Empty({ icon = "folder", title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={32} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Section({ title, description, children, action }) {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Search({ value, onChange, placeholder = "搜索名称…" }) {
  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className="bare"
          aria-label="清除搜索"
          onClick={() => onChange("")}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
export function Intro({ title, subtitle, children }) {
  return (
    <div className="intro">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="intro-actions">{children}</div>
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  wide = false,
  busy = false,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <Button
          icon="close"
          aria-label="关闭弹窗"
          onClick={onClose}
          disabled={busy}
        />
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
const imageCache = new Map();
export function LocalImage({
  path,
  thumbnail = false,
  className = "",
  alt = "",
}) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let alive = true;
    setSource("");
    if (!path) return;
    const key = path + thumbnail;
    if (!imageCache.has(key))
      imageCache.set(
        key,
        window.toolkit.call("image.read", { path, thumbnail }).catch(() => ""),
      );
    imageCache.get(key).then((value) => {
      if (alive) setSource(value);
    });
    return () => {
      alive = false;
    };
  }, [path, thumbnail]);
  return source ? (
    <img className={className} src={source} alt={alt} />
  ) : (
    <span className={`image-placeholder ${className}`}>
      <Icon name="image" />
    </span>
  );
}
export function PathField({
  label,
  value,
  onChange,
  kind,
  multiple = false,
  hint,
}) {
  const [error, setError] = useState("");
  async function pick() {
    try {
      setError("");
      const files = await window.toolkit.call("files.pick", { kind, multiple });
      if (files.length) onChange(multiple ? files : files[0]);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div>
      <Field label={label} hint={hint}>
        <div className="path-field">
          <input
            value={value || ""}
            readOnly
            placeholder="尚未选择"
            title={value}
          />
          <Button icon="folder" aria-label={`选择${label}`} onClick={pick}>
            选择
          </Button>
        </div>
      </Field>
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}
export const basename = (path) => path.split(/[\\/]/).pop() || "";
