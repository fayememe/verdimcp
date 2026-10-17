// Testbench for sync_fifo.
// Scenarios: reset, X on empty read, fill, full backpressure,
// read, simultaneous read+write, empty again.
`timescale 1ns/1ps

module tb_sync_fifo;

    localparam DATA_WIDTH = 8;
    localparam DEPTH      = 4;
    localparam ADDR_WIDTH = 2;

    reg                   clk;
    reg                   rst_n;
    reg                   wr_valid;
    wire                  wr_ready;
    reg  [DATA_WIDTH-1:0] wr_data;
    wire                  rd_valid;
    reg                   rd_ready;
    wire [DATA_WIDTH-1:0] rd_data;
    wire                  full;
    wire                  empty;
    wire [ADDR_WIDTH:0]   count;

    integer               errors;
    reg  [DATA_WIDTH-1:0] rd_capture;

    sync_fifo #(
        .DATA_WIDTH (DATA_WIDTH),
        .DEPTH      (DEPTH),
        .ADDR_WIDTH (ADDR_WIDTH)
    ) dut (
        .clk      (clk),
        .rst_n    (rst_n),
        .wr_valid (wr_valid),
        .wr_ready (wr_ready),
        .wr_data  (wr_data),
        .rd_valid (rd_valid),
        .rd_ready (rd_ready),
        .rd_data  (rd_data),
        .full     (full),
        .empty    (empty),
        .count    (count)
    );

    always #5 clk = ~clk;

    task write_item;
        input [DATA_WIDTH-1:0] data;
        begin
            @(negedge clk);
            wr_valid = 1'b1;
            wr_data  = data;
            @(posedge clk);
            while (!wr_ready) @(posedge clk);
            @(negedge clk);
            wr_valid = 1'b0;
            wr_data  = {DATA_WIDTH{1'b0}};
        end
    endtask

    task read_item;
        output [DATA_WIDTH-1:0] data;
        begin
            @(negedge clk);
            rd_ready = 1'b1;
            @(posedge clk);
            while (!rd_valid) @(posedge clk);
            data = rd_data;
            @(negedge clk);
            rd_ready = 1'b0;
        end
    endtask

    initial begin
        $fsdbDumpfile("sync_fifo.fsdb");
        $fsdbDumpvars(0, tb_sync_fifo);
        $timeformat(-9, 1, " ns", 10);

        clk      = 1'b0;
        rst_n    = 1'b0;
        wr_valid = 1'b0;
        wr_data  = {DATA_WIDTH{1'b0}};
        rd_ready = 1'b0;
        errors   = 0;

        repeat (3) @(posedge clk);
        @(negedge clk);
        rst_n = 1'b1;
        @(negedge clk);

        // X scenario: empty FIFO, rd_data comes from uninitialized memory.
        if (rd_valid !== 1'b0) begin
            $display("[%0t] ERROR: rd_valid=%b while empty", $time, rd_valid);
            errors = errors + 1;
        end
        if (rd_data !== {DATA_WIDTH{1'bx}}) begin
            $display("[%0t] ERROR: expected X on rd_data while empty, got %h", $time, rd_data);
            errors = errors + 1;
        end else begin
            $display("[%0t] OK: rd_data is X while empty (%h)", $time, rd_data);
        end

        // Two writes.
        write_item(8'hA1);
        write_item(8'hA2);
        if (count !== 3'd2) begin
            $display("[%0t] ERROR: count=%0d after two writes", $time, count);
            errors = errors + 1;
        end

        // Fill to full.
        write_item(8'hA3);
        write_item(8'hA4);
        if (count !== 3'd4) begin
            $display("[%0t] ERROR: count=%0d after filling", $time, count);
            errors = errors + 1;
        end
        if (full !== 1'b1) begin
            $display("[%0t] ERROR: full=%b after filling", $time, full);
            errors = errors + 1;
        end
        if (wr_ready !== 1'b0) begin
            $display("[%0t] ERROR: wr_ready=%b while full", $time, wr_ready);
            errors = errors + 1;
        end

        // Write attempt while full must be refused.
        @(negedge clk);
        wr_valid = 1'b1;
        wr_data  = 8'hA5;
        @(posedge clk);
        if (wr_ready !== 1'b0) begin
            $display("[%0t] ERROR: full FIFO accepted a write", $time);
            errors = errors + 1;
        end
        @(negedge clk);
        wr_valid = 1'b0;
        wr_data  = {DATA_WIDTH{1'b0}};
        if (count !== 3'd4) begin
            $display("[%0t] ERROR: count changed on refused write: %0d", $time, count);
            errors = errors + 1;
        end

        // Read two entries.
        read_item(rd_capture);
        if (rd_capture !== 8'hA1) begin
            $display("[%0t] ERROR: expected A1, got %h", $time, rd_capture);
            errors = errors + 1;
        end
        read_item(rd_capture);
        if (rd_capture !== 8'hA2) begin
            $display("[%0t] ERROR: expected A2, got %h", $time, rd_capture);
            errors = errors + 1;
        end
        if (count !== 3'd2) begin
            $display("[%0t] ERROR: count=%0d after two reads", $time, count);
            errors = errors + 1;
        end

        // Simultaneous read (A3) and write (B1); count must stay 2.
        @(negedge clk);
        wr_valid = 1'b1;
        wr_data  = 8'hB1;
        rd_ready = 1'b1;
        @(posedge clk);
        if (rd_data !== 8'hA3) begin
            $display("[%0t] ERROR: expected A3 on simultaneous read, got %h", $time, rd_data);
            errors = errors + 1;
        end
        @(negedge clk);
        wr_valid = 1'b0;
        wr_data  = {DATA_WIDTH{1'b0}};
        rd_ready = 1'b0;
        if (count !== 3'd2) begin
            $display("[%0t] ERROR: count=%0d after simultaneous read/write", $time, count);
            errors = errors + 1;
        end

        // Drain: A4 then B1.
        read_item(rd_capture);
        if (rd_capture !== 8'hA4) begin
            $display("[%0t] ERROR: expected A4, got %h", $time, rd_capture);
            errors = errors + 1;
        end
        read_item(rd_capture);
        if (rd_capture !== 8'hB1) begin
            $display("[%0t] ERROR: expected B1, got %h", $time, rd_capture);
            errors = errors + 1;
        end
        if (empty !== 1'b1) begin
            $display("[%0t] ERROR: empty=%b after drain", $time, empty);
            errors = errors + 1;
        end
        if (rd_valid !== 1'b0) begin
            $display("[%0t] ERROR: rd_valid=%b after drain", $time, rd_valid);
            errors = errors + 1;
        end

        if (errors == 0) begin
            $display("TEST PASSED");
        end else begin
            $display("TEST FAILED: %0d error(s)", errors);
        end
        $finish;
    end

    initial begin
        #10000;
        $display("TIMEOUT");
        $finish;
    end

endmodule
