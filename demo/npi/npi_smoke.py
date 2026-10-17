import os
import sys

npi_python = os.path.join(os.environ["VERDI_HOME"], "share", "NPI", "python")
if npi_python not in sys.path:
    sys.path.insert(0, npi_python)

from pynpi import npisys, waveform


def value_at(file_handle, name, time_ns):
    time = waveform.convert_time_in(file_handle, time_ns, "ns")
    return waveform.sig_value_at(
        file_handle, name, time, waveform.VctFormat_e.HexStrVal
    )


def main():
    fsdb = os.path.abspath(sys.argv[1])
    npisys.init(sys.argv)
    file_handle = waveform.open(fsdb)
    if file_handle is None:
        raise SystemExit("failed to open FSDB: %s" % fsdb)

    try:
        print("fsdb:", file_handle.name())
        print("time_unit:", file_handle.scale_unit())
        print("time_range:", file_handle.min_time(), file_handle.max_time())

        signals = (
            "tb_sync_fifo.clk",
            "tb_sync_fifo.rst_n",
            "tb_sync_fifo.rd_data",
            "tb_sync_fifo.count",
        )
        for name in signals:
            values = {t: value_at(file_handle, name, t) for t in (0, 40, 100, 240)}
            print("%s: %s" % (name, values))

        t0 = waveform.convert_time_in(file_handle, 0, "ns")
        t50 = waveform.convert_time_in(file_handle, 50, "ns")
        t100 = waveform.convert_time_in(file_handle, 100, "ns")
        t240 = waveform.convert_time_in(file_handle, 240, "ns")

        print(
            "rd_data 0..50ns:",
            waveform.sig_value_between(
                file_handle,
                "tb_sync_fifo.rd_data",
                t0,
                t50,
                waveform.VctFormat_e.HexStrVal,
            ),
        )
        print(
            "rd_data x_backward from 100ns:",
            waveform.sig_find_x_backward(
                file_handle,
                "tb_sync_fifo.rd_data",
                t100,
                waveform.VctFormat_e.HexStrVal,
            ),
        )
        print(
            "clk vc_count 0..240ns:",
            waveform.sig_vc_count(file_handle, "tb_sync_fifo.clk", t0, t240),
        )

        checks = {
            ("tb_sync_fifo.rst_n", 40): "1",
            ("tb_sync_fifo.rd_data", 40): "xx",
            ("tb_sync_fifo.count", 240): "0",
        }
        for (name, time_ns), expected in checks.items():
            actual = value_at(file_handle, name, time_ns).lower()
            if actual != expected:
                raise SystemExit(
                    "check failed: %s @ %s ns = %s (expected %s)"
                    % (name, time_ns, actual, expected)
                )
        print("NPI SMOKE PASSED")
    finally:
        waveform.close(file_handle)
        npisys.end()


if __name__ == "__main__":
    main()
