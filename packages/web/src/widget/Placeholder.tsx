import css from "./widget.module.css";

/** Shown in a widget slot whose plugin is missing, incompatible or refused (FR-019). */
export function Placeholder({
  pluginId,
  requiredVersion,
  reason,
}: {
  pluginId: string;
  requiredVersion?: string;
  reason: string;
}) {
  return (
    <div class={css.state} role="note">
      <span>
        Plugin <strong>{pluginId}</strong>
        {requiredVersion ? ` ${requiredVersion}` : ""} is unavailable: {reason}.
      </span>
    </div>
  );
}
