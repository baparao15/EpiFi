import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import Landing from "./pages/Landing.jsx";
import Upload from "./pages/Upload.jsx";
import Result from "./pages/Result.jsx";
import Base64Tool from "./pages/Base64Tool.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/result" element={<Result />} />
        <Route path="/tools/base64" element={<Base64Tool />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
