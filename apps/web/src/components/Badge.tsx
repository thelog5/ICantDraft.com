import type { ReactNode } from "react";
import "./Badge.css";

type BadgeProps = {
  children: ReactNode;
  variant?: "primary" | "success" | "warning" | "danger" | "info";
  className?: string;
};

export default function Badge({
  children,
  variant = "primary",
  className = "",
}: BadgeProps) {
  return <span className={`badge badge-${variant} ${className}`}>{children}</span>;
}