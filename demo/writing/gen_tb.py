#!/usr/bin/env python3
"""Generate a long-running testbench that writes an FSDB while it simulates.

Used by scripts/writing-fsdb.sh to test NPI reads against an FSDB that is still
being written (see docs/architecture.md, "FSDB completeness").
"""

N = 6

print("`timescale 1ns/1ps")
print("module tb_grow;")
print("    reg clk;")
for i in range(N):
    print(f"    reg [31:0] sig{i};")
print("    reg [7:0] data;")
print("    integer cycles;")
print("    initial begin")
print('        $fsdbDumpfile("growing.fsdb");')
print("        $fsdbDumpvars(0, tb_grow);")
print("        clk = 1'b0;")
for i in range(N):
    print(f"        sig{i} = 32'd0;")
print('        if (!$value$plusargs("cycles=%d", cycles)) cycles = 1000000;')
print("        repeat (cycles) @(posedge clk);")
print("        $finish;")
print("    end")
print("    always #0.5 clk = ~clk;")
print("    always @(posedge clk) begin")
for i in range(N):
    print(f"        sig{i} <= sig{i} + 32'd{i + 1};")
print("        if ((sig0 % 997) == 0) data <= 8'hxx;")
print("        else data <= sig0[7:0];")
print("        if (sig0[9:0] == 0) $fsdbDumpflush;")
print("    end")
print("endmodule")
