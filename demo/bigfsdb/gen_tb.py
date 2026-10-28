#!/usr/bin/env python3
"""Generate a synthetic 128-signal testbench for NPI P1 measurements."""
import sys

N = 128

print("`timescale 1ns/1ps")
print("module tb_big;")
print("    reg clk;")
for i in range(N):
    print(f"    reg [31:0] s{i:03d};")
print("    integer cycles;")
print("    initial begin")
print('        $fsdbDumpfile("big.fsdb");')
print("        $fsdbDumpvars(0, tb_big);")
print("        clk = 1'b0;")
for i in range(N):
    print(f"        s{i:03d} = 32'd{i * 2654435761 & 0xFFFFFFFF};")
print('        if (!$value$plusargs("cycles=%d", cycles)) cycles = 1000000;')
print("        repeat (cycles) @(posedge clk);")
print("        $finish;")
print("    end")
print("    always #0.5 clk = ~clk;")
print("    always @(posedge clk) begin")
for i in range(N):
    print(f"        s{i:03d} <= s{i:03d} + 32'd{(i * 2 + 1) & 0xFFFFFFFF};")
print("    end")
print("endmodule")
