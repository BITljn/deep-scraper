import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { BacktestLab } from "./pages/BacktestLab";
import { Dashboard } from "./pages/Dashboard";
import { MuskSignal } from "./pages/MuskSignal";
import { SentimentMatrix } from "./pages/SentimentMatrix";
import { VixFear } from "./pages/VixFear";

const DEFAULT_SYMBOL = "TSLA.US";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard symbol={DEFAULT_SYMBOL} />} />
        <Route
          path="/sentiment"
          element={<SentimentMatrix symbol={DEFAULT_SYMBOL} />}
        />
        <Route path="/musk" element={<MuskSignal symbol={DEFAULT_SYMBOL} />} />
        <Route path="/vix" element={<VixFear symbol={DEFAULT_SYMBOL} />} />
        <Route
          path="/backtest"
          element={<BacktestLab symbol={DEFAULT_SYMBOL} />}
        />
      </Routes>
    </AppShell>
  );
}
