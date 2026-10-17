# Demo simulation entry points.
#
# NOTE: the VCS invocation below is NOT verified in this project yet.
# The project docs only record how to launch Verdi; confirm VCS flags with faye
# before treating any target here as the canonical flow.

VCS        ?= vcs
VERDI      ?= verdi
SIMV       ?= simv
FSDB       ?= sync_fifo.fsdb
PORT       ?= 11066
VCS_FLAGS  ?= -full64 -sverilog +v2k -debug_access+all
VERDI_FLAGS ?=

.PHONY: all sim verdi verdi-server clean

all: sim

sim: $(SIMV)
	./$(SIMV)

$(SIMV): filelist.f ../rtl/sync_fifo.v ../tb/tb_sync_fifo.v
	$(VCS) $(VCS_FLAGS) -f filelist.f -o $(SIMV)

# Open the generated FSDB in Verdi (X display + license required; see demo/README.md).
verdi:
	$(VERDI) $(VERDI_FLAGS) -ssf $(FSDB)

# Same, but expose the Verdi command server for Verdi MCP / libnclt.
verdi-server:
	$(VERDI) $(VERDI_FLAGS) -serverPort $(PORT) -ssf $(FSDB)

clean:
	rm -rf $(SIMV) $(SIMV).daidir csrc ucli.key *.fsdb *.vpd *.log
