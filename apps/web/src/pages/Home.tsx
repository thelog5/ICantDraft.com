import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { hasSettings } from "../lib/settings";

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    if (hasSettings()) {
      navigate("/dashboard");
    } else {
      navigate("/settings");
    }
  }, [navigate]);

  return null;
}
