import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import {
  preferredPrinterId,
  printerChoices,
  setPreferredPrinterId,
  usePrinting,
  type LabelSize,
  type Printer,
  type PrinterChoice,
} from "../../lib/printing";

export type PrinterStatus = Record<string, { ok: boolean; message: string } | undefined>;

// The printers for a label of `size`, which one is picked, and whether each
// answers on the network. Picks this device's printer when it has the right
// stock in, otherwise the best online one; a choice made by hand sticks.
export function usePrinterChoice(size: LabelSize | null) {
  const { data: config } = usePrinting();
  const [preferred, setPreferred] = useState(preferredPrinterId);
  const choices: PrinterChoice[] = useMemo(() => (config ? printerChoices(size, config, preferred) : []), [config, size, preferred]);
  const fitting = choices.filter((c) => c.fits);

  const fittingIds = fitting.map((c) => c.printer.id).join(",");
  const { data: status = {} as PrinterStatus, isFetching: checking } = useQuery({
    queryKey: ["printerStatus", fittingIds],
    queryFn: () => api.checkPrinters(fittingIds.split(",")),
    enabled: fittingIds !== "",
    staleTime: 20_000,
    retry: false,
  });

  const [picked, setPicked] = useState<string | null>(null);
  const auto = fitting.find((c) => status[c.printer.id]?.ok !== false) ?? fitting[0];
  const chosen = fitting.find((c) => c.printer.id === picked) ?? auto ?? null;
  // A different size can rule out the printer picked by hand.
  useEffect(() => {
    if (picked && !fitting.some((c) => c.printer.id === picked)) setPicked(null);
  }, [picked, fitting]);

  // The chosen printer first, then every other one with the same stock
  // (online ones first) to fall back to if it can't be reached.
  const chain: Printer[] = chosen
    ? [
        chosen.printer,
        ...fitting
          .filter((c) => c.printer.id !== chosen.printer.id)
          .sort((a, b) => Number(status[b.printer.id]?.ok ?? 0) - Number(status[a.printer.id]?.ok ?? 0))
          .map((c) => c.printer),
      ]
    : [];

  return {
    config,
    choices,
    fitting,
    chosen: chosen?.printer ?? null,
    chain,
    choose: setPicked,
    status,
    checking,
    preferred,
    // Remember (or forget) the chosen printer as this device's own.
    rememberChosen: (on: boolean) => {
      const id = on ? (chosen?.printer.id ?? null) : null;
      setPreferredPrinterId(id);
      setPreferred(id);
    },
  };
}
