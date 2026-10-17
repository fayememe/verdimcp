# Demo simulation entry points.
#
# VCS/Verdi commands and flags mirror the site aliases in
# /opt/synopsys/env.synopsys.rc (vcscmd / verdicmd), but are invoked through
# synenv.sh so they also work from non-interactive make shells.

SYNENV      ?= ./synenv.sh
VCS         ?= $(SYNENV) vcs
VERDI       ?= $(SYNENV) verdi
SIMV        ?= simv
FSDB        ?= sync_fifo.fsdb
PORT        ?= 11066
VCS_FLAGS   ?= -Mupdate -full64 -fgp -j16 -sverilog +v2k +define+SIM +define+FSDB \
               +incdir+/work/common/rtl/ +lint=TFIPC-L +lint=PCWM \
               -debug_acc+dmptf -debug_region+cell+encrypt \
               -LDFLAGS -Wl,--no-as-needed
VERDI_FLAGS ?= --full64 +define+SIM +incdir+/work/common/rtl/ -sv
DISPLAY_DEFAULT ?= localhost:10.0

.PHONY: all compile sim verdi verdi-server clean

all: sim

compile: $(SIMV)

$(SIMV): filelist.f ../rtl/sync_fifo.v ../tb/tb_sync_fifo.v
	$(VCS) $(VCS_FLAGS) -f filelist.f -l compile.log

sim: $(SIMV)
	./$(SIMV)

# Open the design and the generated FSDB in Verdi.
verdi:
	DISPLAY=$${DISPLAY:-$(DISPLAY_DEFAULT)} XAUTHORITY=$${XAUTHORITY:-$$HOME/.Xauthority} \
		$(VERDI) $(VERDI_FLAGS) -f filelist.f -ssf $(FSDB)

# Same, but expose the Verdi command server for Verdi MCP / libnclt.
verdi-server:
	DISPLAY=$${DISPLAY:-$(DISPLAY_DEFAULT)} XAUTHORITY=$${XAUTHORITY:-$$HOME/.Xauthority} \
		$(VERDI) $(VERDI_FLAGS) -f filelist.f -ssf $(FSDB) -serverPort $(PORT)

clean:
	rm -rf $(SIMV) $(SIMV).daidir csrc ucli.key compile.log *.fsdb *.vpd *.log
