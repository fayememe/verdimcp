// Synchronous FIFO with valid/ready handshakes.
// Demo DUT for verdimcp waveform tests.
`timescale 1ns/1ps

module sync_fifo #(
    parameter DATA_WIDTH = 8,
    parameter DEPTH      = 4,
    parameter ADDR_WIDTH = 2
) (
    input  wire                  clk,
    input  wire                  rst_n,

    input  wire                  wr_valid,
    output wire                  wr_ready,
    input  wire [DATA_WIDTH-1:0] wr_data,

    output wire                  rd_valid,
    input  wire                  rd_ready,
    output wire [DATA_WIDTH-1:0] rd_data,

    output wire                  full,
    output wire                  empty,
    output wire [ADDR_WIDTH:0]   count
);

    reg [DATA_WIDTH-1:0] mem [0:DEPTH-1];
    reg [ADDR_WIDTH-1:0] wr_ptr;
    reg [ADDR_WIDTH-1:0] rd_ptr;
    reg [ADDR_WIDTH:0]   count_r;

    wire do_write = wr_valid && wr_ready;
    wire do_read  = rd_valid && rd_ready;

    assign full     = (count_r == DEPTH);
    assign empty    = (count_r == 0);
    assign wr_ready = ~full;
    assign rd_valid = ~empty;
    assign rd_data  = mem[rd_ptr];   // unwritten entries read as X
    assign count    = count_r;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            wr_ptr  <= {ADDR_WIDTH{1'b0}};
            rd_ptr  <= {ADDR_WIDTH{1'b0}};
            count_r <= {(ADDR_WIDTH + 1){1'b0}};
        end else begin
            if (do_write) begin
                mem[wr_ptr] <= wr_data;
                wr_ptr      <= wr_ptr + 1'b1;
            end
            if (do_read) begin
                rd_ptr <= rd_ptr + 1'b1;
            end
            case ({do_write, do_read})
                2'b10:   count_r <= count_r + 1'b1;
                2'b01:   count_r <= count_r - 1'b1;
                default: count_r <= count_r;
            endcase
        end
    end

endmodule
