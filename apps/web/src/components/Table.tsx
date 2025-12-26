import { ReactNode } from "react";
import "./Table.css";

type TableProps = {
  children: ReactNode;
  className?: string;
};

export default function Table({ children, className = "" }: TableProps) {
  return (
    <div className={`table-wrapper ${className}`}>
      <table className="table">{children}</table>
    </div>
  );
}

