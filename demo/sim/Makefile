# Demo simulation entry points.
#
# Commands run through synenv.sh so they also work when EDA paths are only
# present in an interactive shell. Set SYN_ENV_RC, or source your environment
# before running make.

SYNENV      ?= ./synenv.sh
VCS         ?= $(SYNENV) vcs
VERDI       ?= $(SYNENV) verdi
SIMV        ?= simv
FSDB        ?= sync_fifo.fsdb
PORT        ?= 11066
VCS_FLAGS   ?= -Mupdate -full64 -fgp -j16 -sverilog +v2k +define+SIM +define+FSDB \
               -debug_access+all -debug_region+cell+encrypt -kdb \
               -LDFLAGS -Wl,--no-as-needed
VERDI_FLAGS ?= --full64 +define+SIM -sv

.PHONY: all compile sim verdi verdi-dbdir verdi-server verdi-dbdir-server clean

all: sim

compile: $(SIMV)

$(SIMV): filelist.f ../rtl/sync_fifo.v ../tb/tb_sync_fifo.v
	$(VCS) $(VCS_FLAGS) -f filelist.f -l compile.log

sim: $(SIMV)
	./$(SIMV)

# Open the design and the generated FSDB in Verdi.
verdi:
	DISPLAY=$${DISPLAY:?set DISPLAY} XAUTHORITY=$${XAUTHORITY:-$$HOME/.Xauthority} \
		$(VERDI) $(VERDI_FLAGS) -f filelist.f -ssf $(FSDB)

# Same, but expose the Verdi command server for verdimcp / libnclt.
verdi-server:
	DISPLAY=$${DISPLAY:?set DISPLAY} XAUTHORITY=$${XAUTHORITY:-$$HOME/.Xauthority} \
		$(VERDI) $(VERDI_FLAGS) -f filelist.f -ssf $(FSDB) -serverPort $(PORT)

# Open the VCS-generated KDB (requires -kdb at compile time) instead of re-elaborating sources.
verdi-dbdir:
	DISPLAY=$${DISPLAY:?set DISPLAY} XAUTHORITY=$${XAUTHORITY:-$$HOME/.Xauthority} \
		$(VERDI) $(VERDI_FLAGS) -dbdir $(SIMV).daidir -ssf $(FSDB)

verdi-dbdir-server:
	DISPLAY=$${DISPLAY:?set DISPLAY} XAUTHORITY=$${XAUTHORITY:-$$HOME/.Xauthority} \
		$(VERDI) $(VERDI_FLAGS) -dbdir $(SIMV).daidir -ssf $(FSDB) -serverPort $(PORT)

clean:
	rm -rf $(SIMV) $(SIMV).daidir csrc ucli.key compile.log *.fsdb *.vpd *.log
