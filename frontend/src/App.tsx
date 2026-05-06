import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { HoldingsWatch } from "./pages/HoldingsWatch";
import { MarketCapGdp } from "./pages/MarketCapGdp";
import { Mega7Pe } from "./pages/Mega7Pe";
import { VixFear } from "./pages/VixFear";

const DEFAULT_SYMBOL = "TSLA.US";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HoldingsWatch />} />
        <Route path="/holdings" element={<HoldingsWatch />} />
        <Route path="/macro" element={<MarketCapGdp />} />
        <Route path="/mega7" element={<Mega7Pe />} />
        <Route path="/vix" element={<VixFear symbol={DEFAULT_SYMBOL} />} />
      </Routes>
    </AppShell>
  );
}
