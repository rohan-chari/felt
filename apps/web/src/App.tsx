import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Room } from "./pages/Room";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:roomId" element={<Room />} />
      </Routes>
    </BrowserRouter>
  );
}
