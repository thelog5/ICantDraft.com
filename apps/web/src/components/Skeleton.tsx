import { CSSProperties } from "react";
import "./Skeleton.css";

type SkeletonProps = {
  width?: string;
  height?: string;
  className?: string;
  style?: CSSProperties;
};

export default function Skeleton({
  width = "100%",
  height = "1rem",
  className = "",
  style,
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, ...style }}
    />
  );
}

